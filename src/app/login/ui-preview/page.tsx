import type { Metadata } from "next";
import { FranchiseHome } from "@/home/FranchiseHome";

export const metadata: Metadata = {
  title: "Franchise Mode — UI preview",
  robots: { index: false, follow: false },
};

export default function UIRefreshPreview() {
  return <FranchiseHome preview />;
}
