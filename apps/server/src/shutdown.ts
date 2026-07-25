let shuttingDown = false;

export function beginShutdown() {
	shuttingDown = true;
}

export function isShuttingDown() {
	return shuttingDown;
}
