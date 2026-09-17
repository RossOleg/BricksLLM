import React from "react";
import { PageHeader, EmptyState } from "@/components/ui/page-helpers";
import { Globe } from "lucide-react";

const CustomProvidersPage: React.FC = () => {
  return (
    <div>
      <PageHeader title="Custom Providers" description="User-defined LLM providers" />
      <div className="p-6">
        <EmptyState icon={<Globe className="h-6 w-6" />} title="No custom providers" description="No custom providers configured" />
      </div>
    </div>
  );
};

export default CustomProvidersPage;
