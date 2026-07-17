import type { CurrentOrganization } from "@easy-training/api/contracts/training";
import { createContext, type ReactNode, useContext } from "react";

type OrganizationContextValue = {
	organization: CurrentOrganization;
	isSwitching: boolean;
};

const OrganizationContext = createContext<OrganizationContextValue | null>(
	null,
);

export function OrganizationProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: OrganizationContextValue;
}) {
	return (
		<OrganizationContext.Provider value={value}>
			{children}
		</OrganizationContext.Provider>
	);
}

export function useOrganization(): OrganizationContextValue {
	const context = useContext(OrganizationContext);
	if (!context) {
		throw new Error("useOrganization 必须在 OrganizationProvider 内使用");
	}
	return context;
}
