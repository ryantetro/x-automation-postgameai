import fs from 'fs';
import path from 'path';

const basePath = path.join(process.cwd(), '..', '..', 'state', 'visciousshade');
if (fs.existsSync(basePath)) {
  const x = JSON.parse(fs.readFileSync(path.join(basePath, 'tweet-analytics.json'), 'utf-8'));
  const th = JSON.parse(fs.readFileSync(path.join(basePath, 'threads-analytics.json'), 'utf-8'));

  const xPosts = x.tweets || x;
  const thPosts = th.tweets || th;

  console.log("X posts:", xPosts.length, "Threads posts:", thPosts.length);
  
  // Find a post with metrics
  const xWithMetrics = xPosts.find(p => p.metrics);
  if (xWithMetrics) console.log("X metrics example:", xWithMetrics.runId, xWithMetrics.metrics);
  
  const thWithMetrics = thPosts.find(p => p.runId === xWithMetrics?.runId && p.metrics);
  if (thWithMetrics) console.log("Threads metrics for same runId:", thWithMetrics.runId, thWithMetrics.metrics);
} else {
  console.log("No directory:", basePath);
}
