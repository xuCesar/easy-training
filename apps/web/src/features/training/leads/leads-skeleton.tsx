import { Skeleton } from "@easy-training/ui/components/skeleton";

export function LeadsSkeleton() {
	return (
		<section className="border p-4">
			<div className="flex flex-col gap-4">
				{["one", "two", "three", "four"].map((key) => (
					<div className="flex justify-between" key={key}>
						<Skeleton className="h-9 w-48" />
						<Skeleton className="h-7 w-24" />
					</div>
				))}
			</div>
		</section>
	);
}
