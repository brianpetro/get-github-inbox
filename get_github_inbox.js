// Copyright (c) Brian Joseph Petro

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { GraphQLClient, gql } from 'graphql-request';
import fetch from 'node-fetch';

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
      // console.log('Fetching GitHub API:', url);
      const json = (typeof resp.json === 'function') ? await resp.json() : await resp.json;
      // console.log('Fetched GitHub API data:', json);
      return json;
    } catch (error) {
      // console.error('Error fetching:', error.message);
      console.log('Response:', resp);
      return [];
    }
  }

  async fetch_all_pages(url) {
    let results = [];
    let page = 1;
    while (page <= this.page_limit) {
      const paged_url = `${url}?page=${page}&per_page=${this.per_page}&state=all`;
      // console.log('Fetching page:', page);
      const data = await this.fetch_github_api(paged_url);
      // console.log('Fetched page data:', data);
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

  initGraphQLClient() {
    if (!this.graphQLClient) {
      this.graphQLClient = new GraphQLClient('https://api.github.com/graphql', {
        headers: {
          Authorization: `Bearer ${this.api_key}`
        }
      });
    }
  }

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
      // console.log('Fetching GitHub discussions with GraphQL');
      const data = await this.graphQLClient.request(query);
      // console.log('Fetched GitHub discussions data:', data);
      return data.repository.discussions;
    } catch (error) {
      // console.error('Error fetching discussions:', error.message);
      console.log('Returning inbox');
      return { edges: [], pageInfo: {} };
    }
  }

  async fetch_all_github_discussions() {
    let allDiscussions = [];
    let pageInfo = {};
    let page = 0;
    do {
      const discussions = await this.fetch_github_discussions(pageInfo.endCursor);
      allDiscussions = allDiscussions.concat(discussions.edges.map(edge => edge.node));
      pageInfo = discussions.pageInfo;
      page++;
    } while (pageInfo.hasNextPage && page < this.page_limit);
    return allDiscussions;
  }
}

export async function get_github_inbox(env, params) {
  const smart_sync_md = new SmartSyncMd({
    api_key: params.action.settings.personal_access_token,
    repo_owner: params.action.settings.repository_owner,
    repo_name: params.action.settings.repository_name,
    per_page: params.per_page || 10,
    page_limit: params.page_limit || 1,
  });

  const status = params.status || 'all';
  const state = params.state;

  const issues = await smart_sync_md.fetch_all_github_issues();
  const discussions = await smart_sync_md.fetch_all_github_discussions();

  const filteredIssues = issues.filter(issue => {
    if (status !== 'all' && issue.state !== status) return false;
    if (state && issue.state !== state) return false;
    return true;
  });

  const filteredDiscussions = discussions.filter(discussion => {
    if (state && discussion.state !== state) return false;
    return true;
  });

  return {
    inbox: {
      issues: filteredIssues,
      discussions: filteredDiscussions,
    }
  };
}

export const openapi = {
  paths: {
    "/github-inbox": {
      get: {
        operationId: "get_github_inbox",
        description: "Get GitHub inbox with filtering options",
        parameters: [
          {
            name: "status",
            in: "query",
            description: "Filter issues by status (open, closed, all)",
            schema: {
              type: "string",
              enum: ["open", "closed", "all"],
              default: "all"
            }
          },
          {
            name: "state",
            in: "query",
            description: "Filter issues by state (new, replied)",
            schema: {
              type: "string",
              enum: ["new", "replied"],
            }
          }
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    inbox: {
                      type: "object",
                      properties: {
                        issues: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              number: { type: "integer" },
                              title: { type: "string" },
                              state: { type: "string" },
                              status: { type: "string" },
                              url: { type: "string" },
                              created_at: { type: "string", format: "date-time" },
                              updated_at: { type: "string", format: "date-time" }
                            }
                          }
                        },
                        discussions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              number: { type: "integer" },
                              title: { type: "string" },
                              category: { type: "string" },
                              state: { type: "string" },
                              url: { type: "string" },
                              created_at: { type: "string", format: "date-time" },
                              updated_at: { type: "string", format: "date-time" }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

export const settings = {
  personal_access_token: "password",
  repository_name: "string",
  repository_owner: "string",
};

// console.log('Fetching all GitHub pages');
// console.log('Fetching all GitHub discussions pages');
// console.log('Fetching all GitHub discussions pages');