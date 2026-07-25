import type {
	CreateLeadInput,
	LeadListResult,
	LeadRecord,
	LeadRecordStage,
	LeadStage,
} from "@easy-training/api/contracts/training";

export type LeadFilterStage = "all" | Exclude<LeadStage, "enrolled">;

export type LeadSummary = LeadListResult["items"][number];

export type LeadFormValues = {
	name: string;
	phone: string;
	source: string;
	stage: CreateLeadInput["stage"];
	nextFollowAt: string | null;
	note: string | null;
};

export type FollowUpValues = {
	content: string;
	stage: LeadRecordStage;
	nextFollowAt: string | null;
	lostReason: string | null;
};

export type LeadFormErrors = Partial<Record<keyof LeadFormValues, string>>;

export type FollowUpErrors = Partial<Record<keyof FollowUpValues, string>>;

export type LeadImportPreview = {
	totalRows: number;
	validRows: number;
	errors: Array<{ row: number; message: string }>;
};

export const leadImportHeaders = [
	"姓名",
	"手机号",
	"意向课程编码",
	"来源",
	"负责人邮箱",
	"跟进状态",
	"备注",
	"校区编码",
] as const;

export const stageOptions: Array<{ value: LeadFilterStage; label: string }> = [
	{ value: "all", label: "全部阶段" },
	{ value: "new", label: "新线索" },
	{ value: "contacted", label: "已联系" },
	{ value: "trialBooked", label: "已约试听" },
	{ value: "lost", label: "已失单" },
];

export const initialStageOptions: Array<{
	value: CreateLeadInput["stage"];
	label: string;
}> = stageOptions.filter(
	(item): item is { value: CreateLeadInput["stage"]; label: string } =>
		item.value !== "all" && item.value !== "lost",
);

export const followUpStageOptions = stageOptions.filter(
	(item): item is { value: LeadRecordStage; label: string } =>
		item.value !== "all",
);

export type { LeadRecord, LeadRecordStage };
