import type {
	ClassStatus,
	InvoiceStatus,
	LeadStage,
	StudentStatus,
	TaskPriority,
} from "@easy-training/api/contracts/training";

import type { BadgeTone } from "./components/Badge";

export const leadStageLabel: Record<LeadStage, string> = {
	new: "新线索",
	contacted: "已联系",
	trialBooked: "已约试听",
	enrolled: "已报名",
	lost: "无效",
};

export const leadStageTone: Record<LeadStage, BadgeTone> = {
	new: "blue",
	contacted: "amber",
	trialBooked: "violet",
	enrolled: "green",
	lost: "neutral",
};

export const studentStatusLabel: Record<StudentStatus, string> = {
	active: "在读",
	trial: "试听",
	paused: "暂停",
	graduated: "结课",
	atRisk: "风险",
};

export const studentStatusTone: Record<StudentStatus, BadgeTone> = {
	active: "green",
	trial: "blue",
	paused: "amber",
	graduated: "neutral",
	atRisk: "red",
};

export const classStatusLabel: Record<ClassStatus, string> = {
	recruiting: "招生中",
	running: "开课中",
	paused: "暂停",
	completed: "已结课",
};

export const classStatusTone: Record<ClassStatus, BadgeTone> = {
	recruiting: "blue",
	running: "green",
	paused: "amber",
	completed: "neutral",
};

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
	paid: "已收款",
	pending: "待收款",
	overdue: "逾期",
	refunded: "已退款",
};

export const invoiceStatusTone: Record<InvoiceStatus, BadgeTone> = {
	paid: "green",
	pending: "amber",
	overdue: "red",
	refunded: "neutral",
};

export const taskPriorityTone: Record<TaskPriority, BadgeTone> = {
	high: "red",
	medium: "amber",
	low: "neutral",
};

export const taskPriorityLabel: Record<TaskPriority, string> = {
	high: "高",
	medium: "中",
	low: "低",
};
