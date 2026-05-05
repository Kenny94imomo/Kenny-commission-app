import { useState } from "react";
import { data as routerData, useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const locResponse = await admin.graphql(`
    query {
      locations(first: 20) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `);
  const locJson = await locResponse.json();
  const locations = locJson.data.locations.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
  }));

  const savedRates = await db.locationCommission.findMany({
    where: { shop: session.shop },
  });
  const rateMap = {};
  savedRates.forEach((r) => {
    rateMap[r.locationId] = r.rate;
  });

  const ordersResponse = await admin.graphql(`
    query {
      orders(first: 50, query: "status:any") {
        edges {
          node {
            id
            name
            totalPriceSet { shopMoney { amount currencyCode } }
            createdAt
            displayFinancialStatus
          }
        }
      }
    }
  `);
  const ordersJson = await ordersResponse.json();
  const orders = ordersJson.data.orders.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
    amount: parseFloat(node.totalPriceSet.shopMoney.amount),
    currency: node.totalPriceSet.shopMoney.currencyCode,
    createdAt: node.createdAt,
    status: node.displayFinancialStatus,
  }));

  return routerData({ locations, rateMap, orders, shop: session.shop });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const locationId = formData.get("locationId");
  const locationName = formData.get("locationName");
  const rate = parseFloat(formData.get("rate"));

  await db.locationCommission.upsert({
    where: { shop_locationId: { shop: session.shop, locationId } },
    update: { rate, locationName },
    create: { shop: session.shop, locationId, locationName, rate },
  });

  return routerData({ success: true });
};

export default function CommissionPage() {
  const { locations, rateMap, orders } = useLoaderData();
  const fetcher = useFetcher();

  const [selectedId, setSelectedId] = useState(locations[0]?.id || "");
  const selectedLocation = locations.find((l) => l.id === selectedId);
  const [rate, setRate] = useState(rateMap[selectedId] ?? 0);
  const [saved, setSaved] = useState(false);

  const handleLocationChange = (id) => {
    setSelectedId(id);
    setRate(rateMap[id] ?? 0);
    setSaved(false);
  };

  const handleSave = () => {
    fetcher.submit(
      { locationId: selectedId, locationName: selectedLocation?.name, rate },
      { method: "POST" }
    );
    setSaved(true);
  };

  const r = rate / 100;
  const totalRevenue = orders.reduce((sum, o) => sum + o.amount, 0);
  const commissionAmount = totalRevenue * r;
  const netRevenue = totalRevenue - commissionAmount;

  return (
    <s-page heading="百貨抽成計算">
      <s-section heading="櫃位設定">
        <s-stack direction="block" gap="base">
          <s-select
            label="選擇櫃位"
            value={selectedId}
            onChange={(e) => handleLocationChange(e.target.value)}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </s-select>
          <s-text-field
            label="百貨抽成比例 (%)"
            value={String(rate)}
            type="number"
            onInput={(e) => { setRate(parseFloat(e.target.value) || 0); setSaved(false); }}
          />
          <s-stack direction="inline" gap="base">
            <s-button onClick={handleSave}>儲存設定</s-button>
            {saved && <s-text tone="success">已儲存！</s-text>}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={`${selectedLocation?.name || ""} 營收摘要（最近50筆訂單）`}>
        <s-stack direction="inline" gap="loose">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>總營收</s-text>
              <s-heading>TWD {totalRevenue.toFixed(0)}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>百貨抽成 ({rate}%)</s-text>
              <s-heading>- TWD {commissionAmount.toFixed(0)}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="tight">
              <s-text>淨收入</s-text>
              <s-heading>TWD {netRevenue.toFixed(0)}</s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="訂單明細">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
              <th style={{ textAlign: "left", padding: "8px" }}>訂單</th>
              <th style={{ textAlign: "right", padding: "8px" }}>訂單金額</th>
              <th style={{ textAlign: "right", padding: "8px" }}>抽成金額</th>
              <th style={{ textAlign: "right", padding: "8px" }}>淨收入</th>
              <th style={{ textAlign: "left", padding: "8px" }}>日期</th>
              <th style={{ textAlign: "left", padding: "8px" }}>狀態</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                <td style={{ padding: "8px" }}>{order.name}</td>
                <td style={{ textAlign: "right", padding: "8px" }}>{order.currency} {order.amount.toFixed(2)}</td>
                <td style={{ textAlign: "right", padding: "8px" }}>{order.currency} {(order.amount * r).toFixed(2)}</td>
                <td style={{ textAlign: "right", padding: "8px" }}>{order.currency} {(order.amount * (1 - r)).toFixed(2)}</td>
                <td style={{ padding: "8px" }}>{new Date(order.createdAt).toLocaleDateString("zh-TW")}</td>
                <td style={{ padding: "8px" }}>{order.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};