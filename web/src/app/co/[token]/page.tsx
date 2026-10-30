import { publicDocumentRoute } from "@/components/public-document-page";

const route = publicDocumentRoute("change_order");

export const dynamic = "force-dynamic";
export const generateMetadata = route.generateMetadata;
export default route.Page;
