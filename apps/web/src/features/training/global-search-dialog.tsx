import { Button } from "@easy-training/ui/components/button";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { orpc } from "@/utils/orpc";

const labels = {
	lead: "招生线索",
	student: "学员",
	course: "课程",
	classGroup: "班级",
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
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const navigate = useNavigate();
	const ready = debouncedQuery.length >= 2;
	const options = orpc.training.search.global.queryOptions({
		input: { query: ready ? debouncedQuery : "  " },
	});
	useEffect(() => {
		const id = window.setTimeout(() => {
			setDebouncedQuery(query.trim());
			setActiveIndex(0);
		}, 250);
		return () => window.clearTimeout(id);
	}, [query]);
	const searchQuery = useQuery({
		...options,
		enabled: open && ready,
		queryKey: [...options.queryKey, contextKey],
	});
	const items = useMemo(
		() => searchQuery.data?.groups.flatMap((group) => group.items) ?? [],
		[searchQuery.data],
	);

	useEffect(() => {
		if (!open) {
			setQuery("");
			setDebouncedQuery("");
			setActiveIndex(0);
			return;
		}
		returnFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
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

	function close() {
		onOpenChange(false);
		window.setTimeout(() => returnFocusRef.current?.focus(), 0);
	}

	function select(
		item: NonNullable<
			typeof searchQuery.data
		>["groups"][number]["items"][number],
	) {
		close();
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
			case "classGroup":
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
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}
		>
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
							if (event.key === "Escape") close();
							if (items.length === 0) return;
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActiveIndex((value) => (value + 1) % items.length);
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setActiveIndex(
									(value) => (value - 1 + items.length) % items.length,
								);
							}
							if (event.key === "Enter") {
								event.preventDefault();
								const item = items[activeIndex];
								if (item) select(item);
							}
						}}
						placeholder="搜索线索、学员、课程、班级、课次或单据"
						className="border-0 shadow-none focus-visible:ring-0"
						aria-label="全局搜索"
						role="combobox"
						aria-expanded={ready}
						aria-controls="global-search-results"
						aria-activedescendant={
							items[activeIndex]
								? `global-search-result-${items[activeIndex]?.kind}-${items[activeIndex]?.id}`
								: undefined
						}
					/>
				</div>
				<div
					id="global-search-results"
					role="listbox"
					className="max-h-[60vh] overflow-y-auto p-2"
				>
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
						<div className="flex items-center justify-between gap-3 p-4 text-destructive text-sm">
							<span>搜索失败，请稍后重试。</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => searchQuery.refetch()}
							>
								重试
							</Button>
						</div>
					) : searchQuery.data?.groups.length ? (
						searchQuery.data.groups.map((group) => (
							<section key={group.kind} className="py-1">
								<p className="px-2 py-1 text-muted-foreground text-xs">
									{labels[group.kind]}
								</p>
								{group.items.map((item) => {
									const itemIndex = items.findIndex(
										(candidate) =>
											candidate.kind === item.kind && candidate.id === item.id,
									);
									return (
										<button
											type="button"
											key={item.id}
											id={`global-search-result-${item.kind}-${item.id}`}
											role="option"
											aria-selected={itemIndex === activeIndex}
											onClick={() => select(item)}
											onMouseEnter={() => setActiveIndex(itemIndex)}
											className={`block w-full px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${itemIndex === activeIndex ? "bg-muted" : ""}`}
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
									);
								})}
								{group.hasMore ? (
									<p className="px-2 py-1 text-muted-foreground text-xs">
										仅显示前 5 条，请输入更精确的关键词。
									</p>
								) : null}
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
