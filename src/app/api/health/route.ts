import { createHealthHandler } from "@/infrastructure/health";

export const dynamic = "force-dynamic";
export const GET = createHealthHandler();
