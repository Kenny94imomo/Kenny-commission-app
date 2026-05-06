import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect } from "react";
import { useNavigate } from "react-router";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/app/commission");
  }, [navigate]);
  return null;
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};