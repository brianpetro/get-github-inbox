const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { GraphQLClient, gql } = require('graphql-request');

// TODO: handle discussions
class SmartSyncMd {
  constructor(opts = {}) {
    Object.assign(this, opts);
    this.folder_exists = {};
    this.created = [];
    this.updated = [];
    this.skipped = [];
  }
  async fetch_github_api(url) {
    let resp;
    try {
      resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.api_key}`
        }
      });
      return (typeof resp.json === 'function') ? await resp.json() : await resp.json;
    } catch (error) {
      console.error('Error fetching:', error.message);
      console.log('Response:', resp);
      return [];
    }
  }
  async fetch_github_text(url) {
    let resp;
    try {
      resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.api_key}`
        }
      });
      return await resp.text();
    } catch (error) {
      console.error('Error fetching:', error.message);
      console.log('Response:', resp);
      return '';
    }
  }
  async fetch_all_pages(url) {
    let results = [];
    let page = 1;
    while (true) {
      const paged_url = `${url}?page=${page}&per_page=${this.per_page}&state=all`;
      const data = await this.fetch_github_api(paged_url);
      if (data.length === 0) break;
      results = results.concat(data);
      if (data.length < this.per_page) break; // Last page
      page++;
    }
    return results;
  }
  async fetch_all_github_issues() {
    return await this.fetch_all_pages(`https://api.github.com/repos/${this.repo_owner}/${this.repo_name}/issues`);
  }
  async sync_github_issues() {
    const issues = await this.fetch_all_github_issues();
    await Promise.all(issues.map(issue => this.save_github_issue(issue)));
    console.log(`${issues.length} issues synced`);
    console.log(`${this.updated.length} updated, ${this.created.length} created, ${this.skipped.length} skipped`);
  }
  // override using obsidian adapter
  async ensure_folder_exists(type) {
    if(this.folder_exists[type]) return;
    const dir_path = path.join(__dirname, 'obsidian-1', 'github', this.repo_name, type);
    await fs.promises.mkdir(dir_path, { recursive: true });
    this.folder_exists[type] = true;
  }
  async save_github_issue(issue) {
    if(issue.pull_request) issue.type = 'pull_requests';
    else issue.type = 'issues';
    if(!issue.body) issue.body = '';
    await this.ensure_folder_exists(issue.type); // make sure directory exists
    const file_path = path.join(__dirname, 'obsidian-1', 'github', this.repo_name, issue.type, `${issue.number} ${sanitize_file_name(issue.title)}.md`);
    // check for existing file
    if(await this.exists(file_path)){
      // check for existing frontmatter
      const frontmatter_object = this.get_frontmatter_object(file_path);
      if(!frontmatter_object) return console.error(`Error: File found without frontmatter: "${file_path}", skipping...`); // if no frontmatter, something is off, log and return
      // check if issue is up to date (parse dates and compare)
      const timestamp = Date.parse(issue.updated_at);
      const existing_timestamp = parseInt(frontmatter_object.timestamp);
      // console.log(timestamp, existing_timestamp);
      if(timestamp <= existing_timestamp) return this.skipped.push(issue.number); // if issue is up to date, skip
      // issue is out of date, update it
      this.updated.push(issue.number);
    }else this.created.push(issue.number); // file doesn't exist, create it
    if(issue.type === 'pull_requests'){
      const pull_request_diff = await this.fetch_github_text(issue.pull_request.diff_url);
      if(pull_request_diff.length < 1000) issue.body += '\n\n' + this.render_pull_request_diff(pull_request_diff);
      else issue.body += `\n\nDiff too large to display, [view here](${issue.pull_request.html_url})`
    }
    // console.log(issue);
    const comments = await this.fetch_github_api(issue.comments_url);
    const state = comments[comments.length - 1]?.user.login === 'brianpetro' ? 'replied' : 'new';
    const content = `---\n`
      // + `state: new\n`
      // new if last comment is by someone other than brianpetro
      + `state: ${state}\n`
      + `status: ${issue.state}\n`
      + `url: ${issue.html_url}\n`
      + `participants: ${Object.keys(comments.reduce((acc, comment) => { acc[comment.user.login] = true; return acc; }, {})).length}\n`
      + `comments: ${issue.comments}\n`
      + `reaction_count: ${issue.reactions.total_count}\n`
      + (issue.labels.length > 0 ? `labels:\n  - ${issue.labels.map(label => label.name).join('\n  - ')}\n` : '')
      + `created_at: ${issue.created_at.replace('T', ' ').replace('Z', '')}\n`
      + `updated_at: ${issue.updated_at.replace('T', ' ').replace('Z', '')}\n`
      + `timestamp: ${Date.parse(issue.updated_at)}\n`
      + `---\n\n`
      // + `# ${issue.title}\n\n` // add title
      + `## ${issue.user.login}\n` // add user name
      + `${this.render_body_md(issue.body)}\n\n` // add issue body
      + comments.map(comment => `## ${comment.user.login}\n${this.render_body_md(comment.body)}`).join('\n\n'); // add comments
    ;
    await this.write(file_path, content);
  }
  // add two # to all headers
  render_body_md(text) { return text?.replace(/^([#]{1,4} )/gm, '##$1') ?? ''; }
  // remove text lines that don't start with + or - or @ and wrap in diff code block
  render_pull_request_diff(text) { return "```diff\n" + text.split('\n').filter(line => ['+', '-', '@'].includes(line[0])).join('\n') + "\n```"; }

  // GRAPHQL for discussions
  // Initialize GraphQL client
  initGraphQLClient() {
    if (!this.graphQLClient) {
      this.graphQLClient = new GraphQLClient('https://api.github.com/graphql', {
        headers: {
          Authorization: `Bearer ${this.api_key}`
        }
      });
    }
  }
  // GraphQL query for discussions
  async fetch_github_discussions(afterCursor = null) {
    this.initGraphQLClient();
    const query = gql`
      {
        repository(owner: "${this.repo_owner}", name: "${this.repo_name}") {
          discussions(first: ${this.per_page}, after: ${afterCursor ? `"${afterCursor}"` : null}) {
            edges {
              node {
                id
                number
                title
                author {
                  login
                }
                url
                body
                category {
                  name
                }
                createdAt
                updatedAt
                comments(first: 30) {
                  totalCount
                  nodes {
                    author {
                      login
                    }
                    body
                    bodyText
                    createdAt
                    updatedAt
                    replies(first: 30) {
                      totalCount
                      nodes {
                        author {
                          login
                        }
                        body
                        bodyText
                        createdAt
                        updatedAt
                      }
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    `;

    try {
      const data = await this.graphQLClient.request(query);
      return data.repository.discussions;
    } catch (error) {
      console.error('Error fetching discussions:', error.message);
      return { edges: [], pageInfo: {} };
    }
  }

  // Fetch all discussions (handling pagination)
  async fetch_all_github_discussions() {
    let allDiscussions = [];
    let pageInfo = {};
    do {
      const discussions = await this.fetch_github_discussions(pageInfo.endCursor);
      allDiscussions = allDiscussions.concat(discussions.edges.map(edge => edge.node));
      pageInfo = discussions.pageInfo;
    } while (pageInfo.hasNextPage);
    return allDiscussions;
  }

  async sync_github_discussions() {
    const discussions = await this.fetch_all_github_discussions();
    await Promise.all(discussions.map(discussion => this.save_github_discussion(discussion)));
    // console.log(discussions[0]);
    // await this.save_github_discussion(discussions[0]);
    console.log(`${discussions.length} discussions synced`);
    console.log(`${this.updated.length} updated, ${this.created.length} created, ${this.skipped.length} skipped`);
  }
  
  async save_github_discussion(discussion) {
    await this.ensure_folder_exists('discussions');
    const file_path = path.join(__dirname, 'obsidian-1', 'github', this.repo_name, 'discussions', `${discussion.number} ${sanitize_file_name(discussion.title)}.md`);
    // Check if file exists and whether it needs updating
    // ... Similar logic to save_github_issue ...
    if(await this.exists(file_path)){
      const frontmatter_object = this.get_frontmatter_object(file_path);
      if(!frontmatter_object) return console.error(`Error: File found without frontmatter: "${file_path}", skipping...`); // if no frontmatter, something is off, log and return
      const timestamp = Date.parse(discussion.updatedAt);
      const existing_timestamp = parseInt(frontmatter_object.timestamp);
      if(timestamp <= existing_timestamp) return this.skipped.push(discussion.id); // if discussion is up to date, skip
      this.updated.push(discussion.id);
    }else this.created.push(discussion.id); // file doesn't exist, create it
    // get state
    const state = discussion.comments.nodes[discussion.comments.nodes.length - 1]?.author.login === 'brianpetro' ? 'replied' : 'new';
    // Build file content  
    const content = `---\n`
    // + `state: new\n`
      // new if last comment is by someone other than brianpetro
      + `state: ${state}\n`
      + `url: ${discussion.url}\n`
      + `category: ${discussion.category.name}\n`
      + `created_at: ${discussion.createdAt.replace('T', ' ').replace('Z', '')}\n`
      + `updated_at: ${discussion.updatedAt.replace('T', ' ').replace('Z', '')}\n`
      + `timestamp: ${Date.parse(discussion.updatedAt)}\n`
      + `---\n\n`
      // + `# ${discussion.title}\n\n` // add title
      + `## ${discussion.author.login}\n` // add author name
      + `${this.render_body_md(discussion.body)}\n\n` // add discussion body
      + discussion.comments.nodes.map(comment => 
          `## ${comment.author.login}\n${this.render_body_md(comment.body)}\n\n` + 
          comment.replies.nodes.map(reply => 
              `### ${reply.author.login}\n${this.render_body_md(reply.body)}`).join('\n\n')
        ).join('\n\n'); // add comments and replies
  
    await this.write(file_path, content);
  }
  

}

function sanitize_file_name(title) {
  return title
    .replace(/[\\\/:]/g, '-') // Replace \ / : with -
    .replace(/[#^[\]|<>"|?*!.`]/g, '') // Remove characters #^[]|<>:"/\|?* (obsidian and windows)
    .replace(/[\u0000-\u001f]/g, '') // Remove control characters
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '') // remove emojis
    .replace(/[^\x00-\x7F]/g, '') // remove other unicode characters
    .trim()
  ;
}

const smart_sync_md = new SmartSyncMd({
  // adapters
  exists: fs.existsSync, // obsidian_exists
  fetch_adapter: fetch,
  get_frontmatter_object: get_frontmatter_object, // obsidian_get_frontmatter_object
  mkdir: fs.promises.mkdir,
  write: fs.promises.writeFile,
  // config
  api_key: process.env.GH_TOKEN,
  per_page: 100,
  repo_owner: 'brianpetro',
  repo_name: 'obsidian-smart-connections',
});
smart_sync_md.sync_github_issues();
smart_sync_md.sync_github_discussions();


function get_frontmatter_object(file_path){
  const file_content = fs.readFileSync(file_path, 'utf8');
  if(!file_content.includes('---')) return null; // no frontmatter
  const frontmatter = file_content.split('---')[1].trim();
  const frontmatter_object = frontmatter.split('\n').reduce((acc, line) => {
    const [key, value] = line.split(': ');
    acc[key] = value;
    return acc;
  }, {});
  return frontmatter_object;  
}
// Obsidian functions
function obsidian_exists(file_path) { return !!this.app.metadataCache.getCache(file_path); }
function obsidian_get_frontmatter_object(file_path){ return this.app.metadataCache.getCache(file_path)?.frontmatter; }