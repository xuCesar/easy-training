import { Button } from "@easy-training/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@easy-training/ui/components/dialog";
import { Input } from "@easy-training/ui/components/input";
import { CopyIcon } from "lucide-react";
import { copyInvitationUrl } from "./settings-utils";

export function InvitationLinkDialog({
	url,
	onOpenChange,
}: {
	url: string | null;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={url !== null} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>复制邀请链接</DialogTitle>
					<DialogDescription>
						链接只在此处显示一次，请立即复制并安全发送。
					</DialogDescription>
				</DialogHeader>
				<div className="flex gap-2">
					<Input aria-label="邀请链接" readOnly value={url ?? ""} />
					<Button
						type="button"
						size="icon"
						aria-label="复制邀请链接"
						disabled={!url}
						onClick={() => url && void copyInvitationUrl(url)}
					>
						<CopyIcon />
					</Button>
				</div>
				<DialogFooter>
					<Button type="button" onClick={() => onOpenChange(false)}>
						完成
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
