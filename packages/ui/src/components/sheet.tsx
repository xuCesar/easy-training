"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@easy-training/ui/lib/utils";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetTitle = DialogPrimitive.Title;
const SheetClose = DialogPrimitive.Close;

function SheetContent({
	className,
	side = "left",
	...props
}: DialogPrimitive.Popup.Props & { side?: "left" | "right" }) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-foreground/20" />
			<DialogPrimitive.Viewport className="fixed inset-0 z-50">
				<DialogPrimitive.Popup
					data-slot="sheet-content"
					className={cn(
						"absolute top-0 h-full w-[min(20rem,85vw)] border-r bg-popover p-4 shadow-lg outline-none",
						side === "left" ? "left-0" : "right-0",
						className,
					)}
					{...props}
				/>
			</DialogPrimitive.Viewport>
		</DialogPrimitive.Portal>
	);
}

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger };
