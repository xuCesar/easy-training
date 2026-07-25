import { closeDb } from "@easy-training/db";
import { env } from "@easy-training/env/server";
import { serve } from "@hono/node-server";

import { app } from "./app";
import { startOperationTaskReminderWorker } from "./operation-task-reminder-worker";
import { beginShutdown } from "./shutdown";

let workerStopped = false;
const stopWorker = startOperationTaskReminderWorker({
	isStopped: () => workerStopped,
});

const server = serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	(info) => {
		console.log(`Server is running on http://localhost:${info.port}`);
	},
);

let shuttingDown = false;

async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	beginShutdown();
	workerStopped = true;
	stopWorker();

	console.log(JSON.stringify({ event: "server.shutdown_started", signal }));

	const forceExitTimer = setTimeout(() => {
		console.log(JSON.stringify({ event: "server.shutdown_timeout", signal }));
		process.exit(1);
	}, env.SHUTDOWN_TIMEOUT_MS);
	forceExitTimer.unref();

	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

	await closeDb();
	clearTimeout(forceExitTimer);
	console.log(JSON.stringify({ event: "server.shutdown_completed", signal }));
	process.exit(0);
}

process.once("SIGTERM", () => {
	void shutdown("SIGTERM").catch((error) => {
		console.log(
			JSON.stringify({
				event: "server.shutdown_failed",
				signal: "SIGTERM",
				error: error instanceof Error ? error.message : "Unknown error",
			}),
		);
		process.exit(1);
	});
});

process.once("SIGINT", () => {
	void shutdown("SIGINT").catch((error) => {
		console.log(
			JSON.stringify({
				event: "server.shutdown_failed",
				signal: "SIGINT",
				error: error instanceof Error ? error.message : "Unknown error",
			}),
		);
		process.exit(1);
	});
});
