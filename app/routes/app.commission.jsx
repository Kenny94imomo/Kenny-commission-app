import { useState } from "react";
import { data as routerData, useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const locResponse = await admin.graphql(`
    query {
      locations(first: 50, includeInactive: false) {
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
      orders(first: 250, query: "status:any") {
        edges {
          node {
            id
            name
            totalPriceSet { shopMoney { amount currencyCode } }
            createdAt
            displayFinancialStatus
            fulfillments {
              location {
                id
              }
            }
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
    locationId: node.fulfillments?.[0]?.location?.id || null,
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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

  const filteredOrders = orders.filter((o) => {
    if (o.locationId !== selectedId) return false;
    const orderDate = new Date(o.createdAt);
    if (dateFrom && orderDate < new Date(dateFrom)) return false;
    if (dateTo && orderDate > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  const r = rate / 100;
  const totalRevenue = filteredOrders.reduce((sum, o) => sum + o.amount, 0);
  const commissionAmount = totalRevenue * r;
  const netRevenue = totalRevenue - commissionAmount;

  const exportCSV = () => {
    const headers = ["訂單", "訂單金額", "抽成金額", "淨收入", "日期", "狀態"];
    const rows = filteredOrders.map((order) => [
      order.name,
      order.amount.toFixed(2),
      (order.amount * r).toFixed(2),
      (order.amount * (1 - r)).toFixed(2),
      new Date(order.createdAt).toLocaleDateString("zh-TW"),
      order.status,
    ]);
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedLocation?.name || "櫃位"}_抽成報表.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <s-page heading="百貨抽成計算">

      <s-section heading="櫃位設定">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: "500" }}>選擇櫃位</label>
            <select
              value={selectedId}
              onChange={(e) => handleLocationChange(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", fontSize: "14px", borderRadius: "8px", border: "1px solid #ccc", background: "white", appearance: "auto", paddingRight: "32px" }}
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: "500" }}>百貨抽成比例 (%)</label>
            <input
              type="number"
              value={rate}
              min="0"
              max="100"
              onChange={(e) => { setRate(parseFloat(e.target.value) || 0); setSaved(false); }}
              style={{ width: "100%", padding: "8px 12px", fontSize: "14px", borderRadius: "8px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={handleSave}
            style={{ padding: "8px 20px", fontSize: "14px", borderRadius: "8px", border: "none", background: "#008060", color: "white", cursor: "pointer" }}
          >
            儲存設定
          </button>
          {saved && <span style={{ color: "#008060", fontSize: "14px" }}>✓ 已儲存！</span>}
        </div>
      </s-section>

      <s-section heading="篩選日期">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: "500" }}>開始日期</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", fontSize: "14px", borderRadius: "8px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "14px", fontWeight: "500" }}>結束日期</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", fontSize: "14px", borderRadius: "8px", border: "1px solid #ccc", boxSizing: "border-box" }}
            />
          </div>
        </div>
      </s-section>

      <s-section heading={`${selectedLocation?.name || ""} 營收摘要`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <div style={{ background: "#f6f6f7", borderRadius: "8px", padding: "16px" }}>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "4px" }}>總營收</div>
            <div style={{ fontSize: "22px", fontWeight: "600" }}>TWD {totalRevenue.toFixed(0)}</div>
          </div>
          <div style={{ background: "#f6f6f7", borderRadius: "8px", padding: "16px" }}>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "4px" }}>百貨抽成 ({rate}%)</div>
            <div style={{ fontSize: "22px", fontWeight: "600", color: "#d72c0d" }}>- TWD {commissionAmount.toFixed(0)}</div>
          </div>
          <div style={{ background: "#f6f6f7", borderRadius: "8px", padding: "16px" }}>
            <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "4px" }}>淨收入</div>
            <div style={{ fontSize: "22px", fontWeight: "600", color: "#008060" }}>TWD {netRevenue.toFixed(0)}</div>
          </div>
        </div>
        <div style={{ fontSize: "13px", color: "#6d7175" }}>共 {filteredOrders.length} 筆訂單</div>
      </s-section>

      <s-section heading="訂單明細">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
          <button
            onClick={exportCSV}
            style={{ padding: "8px 16px", fontSize: "14px", borderRadius: "8px", border: "1px solid #008060", background: "white", color: "#008060", cursor: "pointer" }}
          >
            匯出 CSV
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e1e3e5", background: "#f6f6f7" }}>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>訂單</th>
              <th style={{ textAlign: "right", padding: "10px 8px" }}>訂單金額</th>
              <th style={{ textAlign: "right", padding: "10px 8px" }}>抽成金額</th>
              <th style={{ textAlign: "right", padding: "10px 8px" }}>淨收入</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>日期</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>狀態</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "#888" }}>
                  此櫃位在選定期間沒有訂單記錄
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => (
                <tr key={order.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                  <td style={{ padding: "10px 8px", fontWeight: "500" }}>{order.name}</td>
                  <td style={{ textAlign: "right", padding: "10px 8px" }}>{order.currency} {order.amount.toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "10px 8px", color: "#d72c0d" }}>{order.currency} {(order.amount * r).toFixed(2)}</td>
                  <td style={{ textAlign: "right", padding: "10px 8px", color: "#008060" }}>{order.currency} {(order.amount * (1 - r)).toFixed(2)}</td>
                  <td style={{ padding: "10px 8px" }}>{new Date(order.createdAt).toLocaleDateString("zh-TW")}</td>
                  <td style={{ padding: "10px 8px" }}>
                    <span style={{
                      background: order.status === "PAID" ? "#e3f1df" : "#fff4e4",
                      color: order.status === "PAID" ? "#008060" : "#b98900",
                      padding: "2px 10px",
                      borderRadius: "20px",
                      fontSize: "12px"
                    }}>
                      {order.status === "PAID" ? "已付款" : order.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};