import { genericBot } from "./generic-bot.js";

export const demoBot = {
  ...genericBot,
  botId: "demo-bot",
  chatbotName: "Demo PlugBot",
  businessName: "PlugBot AI Demo",
  description: "Demo bot for local widget testing.",
  purpose:
    "Support local development and smoke tests without external AI or website ingestion.",
  websiteUrl: "",
  services: [
    {
      name: "Embeddable chatbot demo",
      description:
        "A vanilla JavaScript widget connected to the PlugBot backend API."
    }
  ],
  faqs: [
    {
      question: "What is PlugBot AI?",
      answer:
        "PlugBot AI is an embeddable website chatbot that connects a JavaScript widget to a backend AI provider router."
    }
  ],
  crawlEnabled: false
};
