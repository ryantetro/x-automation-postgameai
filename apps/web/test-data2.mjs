import fs from 'fs';
import path from 'path';

const basePath = path.join(process.cwd(), '..', '..', 'state', 'canopy');
const x = JSON.parse(fs.readFileSync(path.join(basePath, 'tweet-analytics.json'), 'utf-8'));
const th = JSON.parse(fs.readFileSync(path.join(basePath, 'threads-analytics.json'), 'utf-8'));

function getMetrics(list) {
  const posts = list.tweets || list;
  return posts.filter(p => p.metrics).map(p => ({ runId: p.runId, platform: p.metrics?.platform, tweetId: p.tweetId, threadsPostId: p.threadsPostId }));
}

const xList = getMetrics(x);
const thList = getMetrics(th);

console.log("X posts with metrics:", xList.length);
console.log("Threads posts with metrics:", thList.length);

const sharedRunIds = xList.filter(xP => thList.some(thP => thP.runId === xP.runId));
console.log("Shared runIds:", sharedRunIds.length);
if (sharedRunIds.length > 0) {
  const ex = sharedRunIds[0];
  console.log("Example X:", ex);
  const thP = thPosts.find(p => p.runId === ex.runId);
  console.log("Example Threads:", thP);
}

const thPosts = th.tweets || th;
