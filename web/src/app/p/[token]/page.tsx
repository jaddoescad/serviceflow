import { publicDocumentRoute } from "@/components/public-document-page";

const route = publicDocumentRoute("proposal");

export const dynamic = "force-dynamic";
export const generateMetadata = route.generateMetadata;
export default route.Page;
