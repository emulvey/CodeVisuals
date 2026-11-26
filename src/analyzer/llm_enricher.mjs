/**
 * Optional BYO-LLM Explanation Enricher (OpenAI-compatible / Ollama / Local endpoint).
 * Glassbox V2 works 100% offline with deterministic AST explanations by default;
 * pass `--ai` with GLASSBOX_LLM_URL + GLASSBOX_LLM_KEY to layer LLM prose on top.
 */

export async function enrichWithOptionalLLM(ir, options = {}) {
  const url = options.llmUrl || process.env.GLASSBOX_LLM_URL;
  const apiKey = options.llmKey || process.env.GLASSBOX_LLM_KEY;
  const model = options.llmModel || process.env.GLASSBOX_LLM_MODEL || 'gpt-4o-mini';

  if (!url) return { enriched: false, reason: 'No GLASSBOX_LLM_URL configured; using offline AST semantic explainer.' };

  const compactContext = {
    project: ir.meta.projectName,
    archetype: ir.systemStory?.archetype,
    modules: ir.modules.slice(0, 30).map((m) => ({
      id: m.id, layer: m.layer, libs: m.libraries, intent: m.explanation?.shortIntent,
      functions: m.functionIds.slice(0, 8).map((fid) => fid.split('::').pop())
    })),
    flows: ir.flows.slice(0, 5).map((f) => ({ title: f.title, story: f.storySummary }))
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Return concise JSON: {"headline": string, "moduleIntents": { [moduleId]: string }}. Explain clearly for an engineer onboarding onto this codebase.' },
          { role: 'user', content: JSON.stringify(compactContext) }
        ]
      })
    });
    if (!res.ok) return { enriched: false, reason: `LLM HTTP ${res.status}` };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { enriched: false, reason: 'Non-JSON LLM response' };
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.headline && ir.systemStory) ir.systemStory.headline = parsed.headline;
    if (parsed.moduleIntents) {
      for (const mod of ir.modules) {
        if (parsed.moduleIntents[mod.id] && mod.explanation) {
          mod.explanation.shortIntent = String(parsed.moduleIntents[mod.id]).slice(0, 64);
        }
      }
    }
    return { enriched: true, model };
  } catch (err) {
    return { enriched: false, reason: err.message };
  }
}
