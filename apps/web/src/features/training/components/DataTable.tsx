import type { ReactNode } from "react";

export interface DataTableColumn<T> {
	key: string;
	header: string;
	render: (item: T) => ReactNode;
	align?: "left" | "right";
}

interface DataTableProps<T> {
	columns: DataTableColumn<T>[];
	rows: T[];
	getRowKey: (item: T) => string;
	emptyText?: string;
}

export function DataTable<T>({
	columns,
	rows,
	getRowKey,
	emptyText = "暂无数据",
}: DataTableProps<T>) {
	if (rows.length === 0) {
		return <div className="empty-state">{emptyText}</div>;
	}

	return (
		<div className="table-shell">
			<table>
				<thead>
					<tr>
						{columns.map((column) => (
							<th
								className={column.align === "right" ? "align-right" : undefined}
								key={column.key}
							>
								{column.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={getRowKey(row)}>
							{columns.map((column) => (
								<td
									className={
										column.align === "right" ? "align-right" : undefined
									}
									key={column.key}
								>
									{column.render(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
