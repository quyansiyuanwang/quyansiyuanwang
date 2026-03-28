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
    return events.slice(0, 10);
  } catch {
    return [];
  }
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return formatActivitiesSimple(activities);

  const activityText = activities.map(e => `- ${e.type}: ${e.repo.name}`).join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: '你是一个技术博客助手，用简洁专业的中文总结开发者的 GitHub 活动，3-5句话即可。' },
          { role: 'user', content: `总结这些活动:\n${activityText}` }
        ],
        max_tokens: 200
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
