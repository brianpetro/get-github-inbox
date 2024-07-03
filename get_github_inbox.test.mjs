import test from 'ava';
import { get_github_inbox } from './get_github_inbox.js';
import dotenv from 'dotenv';

dotenv.config();

const mockEnv = {};

const mockParams = {
  action: {
    settings: {
      personal_access_token: process.env.personal_access_token,
      repository_name: process.env.repository_name,
      repository_owner: process.env.repository_owner,
    }
  },
  per_page: 10,
  page: 1,
};

test('get_github_inbox returns expected structure', async t => {
  const result = await get_github_inbox(mockEnv, mockParams);
  t.truthy(result.inbox);
  t.truthy(result.inbox.issues);
  t.truthy(result.inbox.discussions);
});

test('get_github_inbox returns issues and discussions', async t => {
  const result = await get_github_inbox(mockEnv, mockParams);
  // console.log(result.inbox.issues.length, result.inbox.discussions.length); // Log the actual values
  t.is(result.inbox.issues.length, 10);
  t.is(result.inbox.discussions.length, 10);
});