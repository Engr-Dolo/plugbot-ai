export function createMockProvider() {
  return {
    name: "mock",
    async generateReply({ botId, message }) {
      return (
        `Demo response for "${botId}": I received your message, ` +
        `"${message}". This is PlugBot AI running in free local mock mode.`
      );
    }
  };
}
