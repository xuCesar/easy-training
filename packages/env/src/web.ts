import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	clientPrefix: "VITE_",
	client: {
		VITE_SERVER_URL: z.url(),
		VITE_ALLOW_PUBLIC_SIGNUP: z.coerce.boolean().default(false),
	},
	runtimeEnv: (
		import.meta as ImportMeta & {
			readonly env: Record<string, string | boolean | undefined>;
		}
	).env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
