import { processDueOperationTaskReminders } from "@easy-training/db";

const POLL_INTERVAL_MS = 30_000;

type ReminderWorkerLogEvent =
	| { event: "operation_task_reminder.delivered"; count: number }
	| { event: "operation_task_reminder.retry_scheduled"; count: number }
	| { event: "operation_task_reminder.dead"; count: number }
	| {
			event: "operation_task_reminder.failed";
			error: "Unexpected worker error";
	  };

type ReminderWorkerOptions = {
	intervalMs?: number;
	log?: (event: ReminderWorkerLogEvent) => void;
	isStopped?: () => boolean;
};

/** 服务进程内的单一轮询器；实际互斥由数据库租约和幂等键保证。 */
export function startOperationTaskReminderWorker(
	options: ReminderWorkerOptions = {},
) {
	const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
	const log = options.log ?? ((event) => console.log(JSON.stringify(event)));
	const isStopped = options.isStopped ?? (() => false);
	let running = false;

	const run = async () => {
		if (isStopped() || running) return;
		running = true;
		try {
			const result = await processDueOperationTaskReminders();
			if (result.delivered > 0) {
				log({
					event: "operation_task_reminder.delivered",
					count: result.delivered,
				});
			}
			if (result.retried > 0) {
				log({
					event: "operation_task_reminder.retry_scheduled",
					count: result.retried,
				});
			}
			if (result.dead > 0) {
				log({
					event: "operation_task_reminder.dead",
					count: result.dead,
				});
			}
		} catch {
			log({
				event: "operation_task_reminder.failed",
				error: "Unexpected worker error",
			});
		} finally {
			running = false;
		}
	};

	void run();
	const timer = setInterval(() => void run(), intervalMs);
	timer.unref();

	return () => {
		clearInterval(timer);
	};
}
