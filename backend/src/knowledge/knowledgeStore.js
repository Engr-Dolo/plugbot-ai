import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultStoreDirectory = path.resolve(__dirname, "../../data/knowledge");

export function createJsonKnowledgeStore({ directory = defaultStoreDirectory } = {}) {
  return {
    async loadSnapshot(botId) {
      const filePath = getSnapshotPath(directory, botId);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const snapshot = JSON.parse(raw);

        if (!isUsableSnapshot(snapshot, botId)) {
          return null;
        }

        return snapshot;
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) {
          return null;
        }

        throw error;
      }
    },

    async saveSnapshot(snapshot) {
      await fs.mkdir(directory, { recursive: true });
      const filePath = getSnapshotPath(directory, snapshot.botId);
      await fs.writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      return filePath;
    }
  };
}

export function getSnapshotPath(directory, botId) {
  const safeBotId = String(botId || "").replace(/[^a-z0-9_-]/gi, "-");
  return path.join(directory, `${safeBotId}.json`);
}

function isUsableSnapshot(snapshot, botId) {
  return (
    snapshot &&
    snapshot.botId === botId &&
    Array.isArray(snapshot.sections) &&
    Array.isArray(snapshot.pages)
  );
}
