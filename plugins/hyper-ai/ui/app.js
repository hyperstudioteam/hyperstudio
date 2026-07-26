const protocol = "hyperstudio-extension-v1";
const pending = new Map();
let nextId = 1;
let editorContext = {};

function request(method, params = {}) {
  const id = String(nextId++);
  parent.postMessage({ protocol, type: "request", id, method, params }, "*");
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

addEventListener("message", (event) => {
  const message = event.data;
  if (message?.protocol !== protocol) return;
  if (message.type === "event" && message.event === "init") {
    editorContext = message.payload?.context ?? {};
  }
  if (message.type === "response") {
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    message.error
      ? call.reject(new Error(message.error))
      : call.resolve(message.result);
  }
});

const messages = document.querySelector("#messages");
const prompt = document.querySelector("#prompt");

function addMessage(role, text, sql = "") {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.textContent = text;
  if (sql) {
    const code = document.createElement("div");
    code.className = "sql";
    code.textContent = sql;
    node.append(code);
    const insert = document.createElement("button");
    insert.className = "insert";
    insert.textContent = "Insert into editor";
    insert.onclick = () =>
      request("insertEditorSql", { sql: `\n${sql}\n` }).then(() =>
        request("showToast", { message: "SQL inserted" }),
      );
    node.append(insert);
  }
  messages.append(node);
  messages.scrollTop = messages.scrollHeight;
}

document.querySelector("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = prompt.value.trim();
  if (!question) return;
  prompt.value = "";
  addMessage("user", question);
  const currentSql =
    (await request("getSelectedSql")) ||
    (await request("getEditorSql")) ||
    editorContext.sql ||
    "";
  const suggestion = currentSql.trim()
    ? `-- Hyper AI suggestion\n${currentSql.trim()}`
    : "SELECT *\nFROM your_table\nLIMIT 100;";
  addMessage(
    "assistant",
    "Here is a starter suggestion based on the active editor. This demo uses a local response; connect an extension backend to call your model provider.",
    suggestion,
  );
});
