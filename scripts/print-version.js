#!/usr/bin/env node

import { execSync } from 'child_process';

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    let message = execSync('git log -1 --pretty=%s', { encoding: 'utf-8' }).trim();

    if (message.length > 60) {
      message = message.substring(0, 57) + '...';
    }

    console.log(`[Version] Branch: ${branch} | Commit: ${commit} | ${message}`);
  } catch (error) {
    console.log('[Version] Git not available (running from zip or no git repository)');
  }
}

getGitInfo();
