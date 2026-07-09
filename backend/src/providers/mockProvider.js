export function createMockProvider() {
  return {
    name: "mock",
    async generateReply({ botId, message, botContext }) {
      const summary = {
        resolvedBotId: botContext?.bot?.botId || botId,
        fallback: Boolean(botContext?.bot?.fallback),
        structuredKnowledgeAvailable: Boolean(botContext?.structuredKnowledge?.text),
        relevantWebsiteKnowledgeSelected:
          (botContext?.websiteKnowledge?.sections || []).length > 0
      };

      return (
        `Demo response for "${summary.resolvedBotId}": I received your message, ` +
        `"${message}". This is PlugBot AI running in free local mock mode. ` +
        `Structured knowledge: ${summary.structuredKnowledgeAvailable ? "available" : "unavailable"}. ` +
        `Relevant website knowledge: ${summary.relevantWebsiteKnowledgeSelected ? "selected" : "not selected"}.` +
        (summary.fallback ? " Fallback bot configuration was used." : "")
      );
    }
  };
}
