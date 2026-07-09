import { ingestBotKnowledge } from "../src/knowledge/ingestionService.js";
import { pathToFileURL } from "node:url";

export const usageMessage =
  "Usage: npm run ingest -- --bot-id=timetomarket-services";

export function parseBotIdArg(argv = process.argv, env = process.env) {
  const args = Array.from(argv || []);

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "");

    if (arg === "--bot-id") {
      const next = args[index + 1];
      return next && !String(next).startsWith("--") ? normalizeBotId(next) : "";
    }

    if (arg.startsWith("--bot-id=")) {
      return normalizeBotId(arg.slice("--bot-id=".length));
    }
  }

  return normalizeBotId(env?.npm_config_bot_id || env?.npm_config_botId || "");
}

export async function runIngestionCli({
  argv = process.argv,
  env = process.env,
  ingest = ingestBotKnowledge,
  stdout = console.log,
  stderr = console.error
} = {}) {
  const botId = parseBotIdArg(argv, env);

  if (!botId) {
    stderr(usageMessage);
    return 1;
  }

  try {
    const result = await ingest({ botId });
    const { summary } = result.snapshot;

    stdout(`Bot:\n${result.snapshot.botId}\n`);
    stdout(`Pages discovered:\n${summary.pagesDiscovered}\n`);
    stdout(`Pages crawled:\n${summary.pagesCrawled}\n`);
    stdout(`Pages skipped:\n${summary.pagesSkipped}\n`);
    stdout(`Pages rejected:\n${summary.pagesRejected}\n`);
    stdout(`Ingestion quality:\n${summary.extractionQuality?.status || "UNKNOWN"}`);
    stdout(
      `Reason:\n${summary.extractionQuality?.reason || "Extraction quality was not assessed."}\n`
    );
    stdout("Sensitive findings:");
    if (summary.sensitiveFindings.length === 0) {
      stdout("0 findings");
    } else {
      for (const finding of summary.sensitiveFindings) {
        stdout(`${finding.category}: ${finding.count} ${finding.action}`);
      }
    }
    stdout(`\nKnowledge sections:\n${summary.knowledgeSections}\n`);
    stdout(`Snapshot saved:\n${result.filePath}`);
    return 0;
  } catch (error) {
    stderr(error?.message || "Ingestion failed.");
    return 1;
  }
}

function normalizeBotId(value) {
  return String(value || "").trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runIngestionCli();
}
