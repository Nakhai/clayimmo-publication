// Relevé quotidien des statistiques Buffer des publications ClayImmo.
// Écrit une ligne « [metrics] {json} » dans les journaux Railway, lue ensuite pour les bilans.
import { gql } from "./buffer.js";

const log = (...a) => console.log("[metrics]", ...a);

const POSTS = `query($i: PostsInput!, $after: String) {
  posts(input: $i, first: 50, after: $after) {
    edges { node { id text channelService sentAt dueAt status
      metadata { ... on InstagramPostMetadata { type } ... on GoogleBusinessPostMetadata { type } }
      metrics { type value } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function collectMetrics(days = 60) {
  if (!process.env.BUFFER_TOKEN_CLAYIMMO) return;
  const acc = await gql("query { account { timezone organizations { id name } } }");
  const start = new Date(Date.now() - days * 864e5).toISOString();
  const end = new Date().toISOString();
  for (const org of acc.account.organizations) {
    const out = [];
    let after = null;
    do {
      const d = await gql(POSTS, { i: { organizationId: org.id, filter: { status: ["sent", "error"], dueAt: { start, end } } }, after });
      for (const { node: p } of d.posts.edges || []) {
        const m = {};
        for (const x of p.metrics || []) m[x.type] = x.value;
        out.push({ id: p.id, canal: p.channelService, type: p.metadata?.type || null, statut: p.status,
          le: p.sentAt || p.dueAt, debut: String(p.text || "").replace(/\s+/g, " ").slice(0, 70), m });
      }
      after = d.posts.pageInfo?.hasNextPage ? d.posts.pageInfo.endCursor : null;
    } while (after);
    let agg = null;
    try {
      const a = await gql(`query($i: AggregatedPostMetricsInput!) { aggregatedPostMetrics(input: $i) { metrics { type value } } }`,
        { i: { organizationId: org.id, startDateTime: start, endDateTime: end } });
      agg = Object.fromEntries((a.aggregatedPostMetrics.metrics || []).map((x) => [x.type, x.value]));
    } catch (e) { agg = { erreur: e.message.slice(0, 120) }; }
    log(JSON.stringify({ releve: end, organisation: org.name, jours: days, total: agg, posts: out }));
  }
}

export function startMetrics() {
  const run = () => collectMetrics().catch((e) => log("échec", e.message));
  setTimeout(run, 120e3);
  setInterval(run, 24 * 3600e3);
}
