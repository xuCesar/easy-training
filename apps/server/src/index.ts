import { env } from "@easy-training/env/server";
import { serve } from "@hono/node-server";

import { app } from "./app";

serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	(info) => {
		console.log(`Server is running on http://localhost:${info.port}`);
	},
);
