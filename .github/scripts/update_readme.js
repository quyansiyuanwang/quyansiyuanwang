#!/usr/bin/env node
const fs = require('fs');
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function getGithubStats(username = 'quyansiyuanwang') {
  try {
    const user = await httpsGet(`https://api.github.com/users/${username}`);
    const repos = await httpsGet(`https://api.github.com/users/${username}/repos?per_page=100`);

    const totalStars = repos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
    const languages = {};

    repos.forEach(repo => {
      if (repo.language) {
        languages[repo.language] = (languages[repo.language] || 0) + 1;
      }
    });

    const topLang = Object.entries(languages).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    return {
      repos: user.public_repos,
      followers: user.followers,
      stars: totalStars,
      topLanguage: topLang
    };
  } catch {
    return null;
  }
}

async function getGithubActivity(username = 'quyansiyuanwang') {
  try {
    const events = await httpsGet(`https://api.github.com/users/${username}/events/public`);
    return events.slice(0, 20);
  } catch {
    return [];
  }
}

function extractDetailedActivities(activities) {
  const details = [];

  for (const event of activities) {
    const repo = event.repo.name;
    const date = new Date(event.created_at).toLocaleDateString('zh-CN');

    if (event.type === 'PushEvent') {
      const commits = event.payload.commits || [];
      commits.forEach(commit => {
        details.push(`[${date}] 提交到 ${repo}: ${commit.message}`);
      });
    } else if (event.type === 'PullRequestEvent') {
      const pr = event.payload.pull_request;
      details.push(`[${date}] ${event.payload.action} PR #${pr.number} 在 ${repo}: ${pr.title}`);
    } else if (event.type === 'IssuesEvent') {
      const issue = event.payload.issue;
      details.push(`[${date}] ${event.payload.action} Issue #${issue.number} 在 ${repo}: ${issue.title}`);
    } else if (event.type === 'CreateEvent') {
      details.push(`[${date}] 创建 ${event.payload.ref_type} 在 ${repo}`);
    } else if (event.type === 'IssueCommentEvent') {
      details.push(`[${date}] 评论 Issue 在 ${repo}`);
    }
  }

  return details.slice(0, 15);
}

function formatActivitiesSimple(activities) {
  if (!activities.length) return '🔄 持续学习与开发中...';

  const summary = [];
  for (const event of activities.slice(0, 5)) {
    const repo = event.repo.name.split('/').pop();
    if (event.type === 'PushEvent') summary.push(`📝 提交代码到 ${repo}`);
    else if (event.type === 'CreateEvent') summary.push(`✨ 创建了 ${repo}`);
    else if (event.type === 'PullRequestEvent') summary.push(`🔀 提交 PR 到 ${repo}`);
  }

  return summary.slice(0, 3).join('\n') || '🔄 持续学习与开发中...';
}

async function summarizeWithAI(activities) {
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.AI_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) return formatActivitiesSimple(activities);

  const details = extractDetailedActivities(activities);
  const activityText = details.join('\n');

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: '你是一个技术总结助手。根据开发者的 GitHub 活动，用简洁专业的中文总结他最近在做什么、做了哪些贡献。重点关注：1) 主要工作的项目 2) 提交的功能或修复 3) 参与的协作。用 3-5 个要点列出，每个要点一行，使用 emoji 开头。'
          },
          { role: 'user', content: `总结这些活动:\n${activityText}` }
        ],
        max_tokens: 300
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.choices[0].message.content;
    }
  } catch {}

  return formatActivitiesSimple(activities);
}

async function updateReadme() {
  let content = fs.readFileSync('README.md', 'utf-8');

  // 更新日期
  const today = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  content = content.replace(
    /!\[Last Updated\]\(https:\/\/img\.shields\.io\/badge\/Last%20Updated-[^)]+\)/,
    `![Last Updated](https://img.shields.io/badge/Last%20Updated-${today.replace(' ', '%20')}-blue?style=for-the-badge)`
  );

  // 更新活动
  const activities = await getGithubActivity();
  const summary = await summarizeWithAI(activities);
  content = content.replace(
    /<!-- ACTIVITY_START -->[\s\S]*?<!-- ACTIVITY_END -->/,
    `<!-- ACTIVITY_START -->\n${summary}\n<!-- ACTIVITY_END -->`
  );

  // 更新统计数据
  const stats = await getGithubStats();
  if (stats) {
    const statsText = `📊 ${stats.repos} repos · ⭐ ${stats.stars} stars · 👥 ${stats.followers} followers · 💻 Top: ${stats.topLanguage}`;
    content = content.replace(
      /<!-- STATS_START -->[\s\S]*?<!-- STATS_END -->/,
      `<!-- STATS_START -->\n${statsText}\n<!-- STATS_END -->`
    );
  }

  fs.writeFileSync('README.md', content, 'utf-8');
}

updateReadme().catch(console.error);
