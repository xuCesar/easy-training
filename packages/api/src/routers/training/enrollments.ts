import {
	createIndependentEnrollmentInputSchema,
	createIndependentEnrollmentResultSchema,
	independentEnrollmentOptionsInputSchema,
	independentEnrollmentOptionsSchema,
	updateEnrollmentLifecycleInputSchema,
	updateEnrollmentLifecycleResultSchema,
} from "../../contracts/training";
import { studentProcedure } from "../../index";
import { updateEnrollmentLifecycle } from "../../repositories/enrollment-lifecycle";
import {
	createIndependentEnrollment,
	getIndependentEnrollmentOptions,
} from "../../repositories/enrollment-registration";

export const enrollmentsRouter = {
	lifecycle: studentProcedure
		.input(updateEnrollmentLifecycleInputSchema)
		.output(updateEnrollmentLifecycleResultSchema)
		.handler(({ context, input }) =>
			updateEnrollmentLifecycle(
				{
					organizationId: context.organization.id,
					userId: context.session.user.id,
				},
				input,
			),
		),
	independentOptions: studentProcedure
		.input(independentEnrollmentOptionsInputSchema)
		.output(independentEnrollmentOptionsSchema)
		.handler(({ context, input }) =>
			getIndependentEnrollmentOptions(
				{
					organizationId: context.organization.id,
					role: context.role,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
	createIndependent: studentProcedure
		.input(createIndependentEnrollmentInputSchema)
		.output(createIndependentEnrollmentResultSchema)
		.handler(({ context, input }) =>
			createIndependentEnrollment(
				{
					organizationId: context.organization.id,
					role: context.role,
					userId: context.session.user.id,
					campusAccess: context.campusAccess,
				},
				input,
			),
		),
};
