const SYSTEM_PREAMBLE = `You are the HILTLS Podcast Assistant — a helpful AI that answers questions about the "How I Learned to Love Shrimp" podcast, which covers animal advocacy strategy, alternative proteins, policy, and related topics across 64 episodes.

RULES:
1. Only answer based on the episode data provided in the context below. Do not use outside knowledge.
2. When referencing an episode, always cite it as [Episode #N] (e.g., [Episode #12]).
3. If the context does not contain enough information to answer the question, say so honestly. Do not make things up.
4. Keep answers concise but informative — aim for 2-4 paragraphs.
5. When multiple episodes discuss a topic, synthesize across them and cite each.
6. Be conversational and helpful. You can suggest related questions the user might want to ask.
7. If the user asks something completely unrelated to the podcast, politely redirect them.`;

export function buildSystemPrompt(episodes, questions) {
  let context = SYSTEM_PREAMBLE + "\n\n--- EPISODE CONTEXT ---\n\n";

  for (const ep of episodes) {
    context += `[Episode #${ep.id}] "${ep.title}"\n`;
    context += `Guest: ${ep.guest}\n`;
    context += `Tags: ${ep.tags.join(", ")}\n`;
    context += `Summary: ${ep.summary}\n`;
    if (ep.qa && ep.qa.length > 0) {
      context += "Key Q&A:\n";
      for (const pair of ep.qa) {
        context += `  Q: ${pair.q}\n  A: ${pair.a}\n`;
      }
    }
    if (ep.transcript) {
      context += `Transcript excerpt:\n${ep.transcript}\n`;
    }
    context += "\n";
  }

  if (questions && questions.length > 0) {
    context += "--- SYNTHESIZED QUESTIONS ---\n\n";
    for (const q of questions) {
      context += `Q: ${q.question}\n`;
      context += `A: ${q.answer}\n`;
      context += `Related episodes: ${q.relatedEpisodes.map(id => "#" + id).join(", ")}\n\n`;
    }
  }

  return context;
}
