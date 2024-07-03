# Get GitHub Inbox Smart Action

## Description
The Get GitHub Inbox Smart Action is a custom action for Smart Connect that allows users to fetch and filter issues and discussions from a specified GitHub repository. This action provides an easy way to retrieve your GitHub inbox, including both issues and discussions, with options to filter by status and state.

## Features
Fetch issues and discussions from a specified GitHub repository
Filter issues by status (open, closed, all)
Filter issues and discussions by state (new, replied)
Pagination support for large repositories

## Installation
Use the "Add Action" button in Smart Connect.

### Configuration
To use this Smart Action, you need to configure the following settings in the Smart Connect app:
1. personal_access_token: Your GitHub Personal Access Token
2. repository_name: The name of the repository you want to fetch from
3. repository_owner: The owner of the repository (username or organization name)

## How it works
The Get GitHub Inbox Smart Action exposes an API endpoint that can be called with the following parameters:
`status` (optional): Filter issues by status (open, closed, all). Default is "all".
`state` (optional): Filter issues and discussions by state (new, replied).
`per_page` (optional): Number of items to fetch per page. Default is 10.
`page_limit` (optional): Maximum number of pages to fetch. Default is 1.

## Response
The action returns a JSON object containing two arrays:
1. issues: An array of GitHub issues matching the specified filters
2. discussions: An array of GitHub discussions matching the specified filters
Each item in these arrays contains relevant information such as the issue/discussion number, title, state, URL, and timestamps.