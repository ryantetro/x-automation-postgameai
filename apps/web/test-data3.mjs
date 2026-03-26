import fs from 'fs';
const th = JSON.parse(fs.readFileSync('../../state/canopy/threads-analytics.json', 'utf-8'));
const thPosts = th.tweets || th;
console.log("Threads posts total:", thPosts.length);
console.log("Threads posts with tweetId:", thPosts.filter(p => p.tweetId).length);
console.log("Threads posts with metrics.platform === 'x':", thPosts.filter(p => p.metrics?.platform === 'x').length);
