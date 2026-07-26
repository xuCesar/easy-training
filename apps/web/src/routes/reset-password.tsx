import { Button } from "@easy-training/ui/components/button";
import { Input } from "@easy-training/ui/components/input";
import { Label } from "@easy-training/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

const authPasswordMinLength = 10;
const authPasswordMaxLength = 128;

export const Route = createFileRoute("/reset-password")({
	validateSearch: z.object({
		token: z.string().optional(),
		error: z.string().optional(),
	}),
	component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
	const navigate = useNavigate();
	const { token, error } = Route.useSearch();

	const form = useForm({
		defaultValues: {
			password: "",
			confirmPassword: "",
		},
		onSubmit: async ({ value }) => {
			if (!token) {
				toast.error("重置链接无效或已过期。");
				return;
			}
			const { error: resetError } = await authClient.resetPassword({
				newPassword: value.password,
				token,
			});
			if (resetError) {
				toast.error(resetError.message || "重置失败，请重新申请链接。");
				return;
			}
			toast.success("密码已重置，请使用新密码登录。");
			await navigate({ to: "/login" });
		},
		validators: {
			onSubmit: z
				.object({
					password: z
						.string()
						.min(authPasswordMinLength, "密码至少需要 10 个字符")
						.max(authPasswordMaxLength, "密码不能超过 128 个字符"),
					confirmPassword: z.string(),
				})
				.refine((value) => value.password === value.confirmPassword, {
					message: "两次输入的密码不一致",
					path: ["confirmPassword"],
				}),
		},
	});

	if (error === "INVALID_TOKEN" || !token) {
		return (
			<main className="mx-auto mt-10 w-full max-w-md p-6 text-center">
				<h1 className="mb-2 font-bold text-3xl">链接无效</h1>
				<p className="mb-6 text-muted-foreground text-sm">
					重置链接已失效或已被使用，请重新申请。
				</p>
				<Link to="/forgot-password">
					<Button className="w-full">重新申请重置链接</Button>
				</Link>
			</main>
		);
	}

	return (
		<main className="mx-auto mt-10 w-full max-w-md p-6">
			<h1 className="mb-6 text-center font-bold text-3xl">设置新密码</h1>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-4"
			>
				<form.Field name="password">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name}>新密码</Label>
							<Input
								id={field.name}
								name={field.name}
								type="password"
								autoComplete="new-password"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
							{field.state.meta.errors.map((fieldError) => (
								<p key={fieldError?.message} className="text-red-500">
									{fieldError?.message}
								</p>
							))}
						</div>
					)}
				</form.Field>

				<form.Field name="confirmPassword">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor={field.name}>确认新密码</Label>
							<Input
								id={field.name}
								name={field.name}
								type="password"
								autoComplete="new-password"
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
							{field.state.meta.errors.map((fieldError) => (
								<p key={fieldError?.message} className="text-red-500">
									{fieldError?.message}
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
							{isSubmitting ? "保存中..." : "保存新密码"}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</main>
	);
}
