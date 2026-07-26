import { Button } from "@easy-training/ui/components/button";
import { Input } from "@easy-training/ui/components/input";
import { Label } from "@easy-training/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/forgot-password")({
	component: ForgotPasswordRoute,
});

function ForgotPasswordRoute() {
	const [submitted, setSubmitted] = useState(false);
	const form = useForm({
		defaultValues: {
			email: "",
		},
		onSubmit: async ({ value }) => {
			const { error } = await authClient.requestPasswordReset({
				email: value.email,
				redirectTo: `${window.location.origin}/reset-password`,
			});
			if (error) {
				toast.error(error.message || "请求失败，请稍后重试。");
				return;
			}
			setSubmitted(true);
		},
		validators: {
			onSubmit: z.object({
				email: z.email("请输入有效邮箱"),
			}),
		},
	});

	return (
		<main className="mx-auto mt-10 w-full max-w-md p-6">
			<h1 className="mb-2 text-center font-bold text-3xl">忘记密码</h1>
			<p className="mb-6 text-center text-muted-foreground text-sm">
				输入注册邮箱，我们将发送重置链接（若账号存在）。
			</p>

			{submitted ? (
				<div className="space-y-4 text-center">
					<p className="text-sm">
						若该邮箱已注册，您将收到密码重置邮件。请检查收件箱与垃圾邮件文件夹。
					</p>
					<Link to="/login">
						<Button variant="outline" className="w-full">
							返回登录
						</Button>
					</Link>
				</div>
			) : (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor={field.name}>邮箱</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									autoComplete="email"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-red-500">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>

					<form.Subscribe
						selector={(state) => ({
							canSubmit: state.canSubmit,
							isSubmitting: state.isSubmitting,
						})}
					>
						{({ canSubmit, isSubmitting }) => (
							<Button
								type="submit"
								className="w-full"
								disabled={!canSubmit || isSubmitting}
							>
								{isSubmitting ? "发送中..." : "发送重置链接"}
							</Button>
						)}
					</form.Subscribe>

					<div className="text-center">
						<Link to="/login">
							<Button variant="link">返回登录</Button>
						</Link>
					</div>
				</form>
			)}
		</main>
	);
}
