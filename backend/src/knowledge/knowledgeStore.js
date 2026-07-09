import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultStoreDirectory = path.resolve(__dirname, "../../data/knowledge");

export function createJsonKnowledgeStore({ directory = defaultStoreDirectory } = {}) {
  return {
    async loadSnapshot(botId) {
      const inspected = await this.inspectSnapshot(botId);
      return inspected.valid ? inspected.snapshot : null;
    },

    async inspectSnapshot(botId) {
      const filePath = getSnapshotPath(directory, botId);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const snapshot = JSON.parse(raw);

        if (!isUsableSnapshot(snapshot, botId)) {
          return {
            found: true,
            valid: false,
            reason: "Snapshot is missing required fields or has a mismatched botId."
          };
        }

        return {
          found: true,
          valid: true,
          reason: "Snapshot is usable.",
          snapshot
        };
      } catch (error) {
        if (error.code === "ENOENT") {
          return { found: false, valid: false, reason: "Snapshot file was not found." };
        }

        if (error instanceof SyntaxError) {
          return { found: true, valid: false, reason: "Snapshot JSON is malformed." };
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

export function isUsableSnapshot(snapshot, botId) {
  return (
    snapshot &&
    snapshot.botId === botId &&
    Array.isArray(snapshot.sections) &&
    Array.isArray(snapshot.pages)
  );
}
