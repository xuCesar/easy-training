import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Input } from "@easy-training/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { orpc } from "@/utils/orpc";

const labels = {
	lead: "招生线索",
	student: "学员",
	course: "课程",
	class: "班级",
	lesson: "课次",
	invoice: "应收账单",
	receipt: "收据",
} as const;

export function GlobalSearchDialog({
	open,
	onOpenChange,
	contextKey,
	role,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	contextKey: string;
	role: string | undefined;
}) {
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query.trim());
	const inputRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const ready = deferredQuery.length >= 2;
	const options = orpc.training.search.global.queryOptions({
		input: { query: ready ? deferredQuery : "  " },
	});
	const searchQuery = useQuery({
		...options,
		enabled: open && ready,
		queryKey: [...options.queryKey, contextKey],
	});

	useEffect(() => {
		if (!open) {
			setQuery("");
			return;
		}
		const id = window.setTimeout(() => inputRef.current?.focus(), 0);
		return () => window.clearTimeout(id);
	}, [open]);
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				onOpenChange(true);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpenChange]);

	function select(
		item: NonNullable<
			typeof searchQuery.data
		>["groups"][number]["items"][number],
	) {
		onOpenChange(false);
		switch (item.kind) {
			case "lead":
				void navigate({ to: "/leads", search: { leadId: item.id } });
				break;
			case "student":
				void navigate({ to: "/students", search: { studentId: item.id } });
				break;
			case "course":
				void navigate({
					to: "/academic",
					search: { tab: "courses", courseId: item.id },
				});
				break;
			case "class":
				void navigate({
					to: "/academic",
					search: { tab: "classes", classGroupId: item.id },
				});
				break;
			case "lesson":
				void navigate(
					role === "teacher"
						? { to: "/teacher", search: { lessonId: item.id } }
						: {
								to: "/academic",
								search: { tab: "lessons", lessonId: item.id },
							},
				);
				break;
			case "invoice":
				void navigate({ to: "/finance", search: { invoiceId: item.id } });
				break;
			case "receipt":
				void navigate({
					to: "/finance",
					search: { invoiceId: item.invoiceId, receiptId: item.id },
				});
				break;
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl p-0">
				<DialogHeader className="sr-only">
					<DialogTitle>全局搜索</DialogTitle>
				</DialogHeader>
				<div className="flex items-center gap-2 border-b px-4">
					<SearchIcon className="size-4 text-muted-foreground" />
					<Input
						ref={inputRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") onOpenChange(false);
						}}
						placeholder="搜索线索、学员、课程、班级、课次或单据"
						className="border-0 shadow-none focus-visible:ring-0"
						aria-label="全局搜索"
					/>
				</div>
				<div className="max-h-[60vh] overflow-y-auto p-2">
					{!ready ? (
						<p className="p-4 text-muted-foreground text-sm">
							请输入至少 2 个字符。
						</p>
					) : searchQuery.isLoading ? (
						<p className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
							<LoaderCircleIcon className="size-4 animate-spin" />
							正在搜索…
						</p>
					) : searchQuery.isError ? (
						<p className="p-4 text-destructive text-sm">
							搜索失败，请稍后重试。
						</p>
					) : searchQuery.data?.groups.length ? (
						searchQuery.data.groups.map((group) => (
							<section key={group.kind} className="py-1">
								<p className="px-2 py-1 text-muted-foreground text-xs">
									{labels[group.kind]}
								</p>
								{group.items.map((item) => (
									<button
										type="button"
										key={item.id}
										onClick={() => select(item)}
										className="block w-full px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
									>
										<span className="block font-medium text-sm">
											{item.title}
										</span>
										{item.subtitle ? (
											<span className="block truncate text-muted-foreground text-xs">
												{item.subtitle}
											</span>
										) : null}
									</button>
								))}
							</section>
						))
					) : (
						<p className="p-4 text-muted-foreground text-sm">
							没有找到匹配结果。
						</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
