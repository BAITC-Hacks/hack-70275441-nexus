import { Suspense } from "react";
import { InvestigationWorkspace } from "@/components/nexus/workspace/InvestigationWorkspace";

export default function InvestigatePage() { return <Suspense fallback={null}><InvestigationWorkspace /></Suspense>; }
