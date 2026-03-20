export interface ServiceMethodDef {
  name: string;
  signature: string;
  doc: string;
  snippet?: string;
}

export const SERVICE_METHODS: Record<string, ServiceMethodDef[]> = {
  orm: [
    {
      name: "search",
      signature: "search(model, domain?, options?)",
      doc: "Search for record IDs matching domain",
      snippet: 'search("${1:model}", ${2:[]})',
    },
    {
      name: "searchRead",
      signature: "searchRead(model, domain?, fields?, options?)",
      doc: "Search records and return field values",
      snippet: 'searchRead("${1:model}", ${2:[]}, ${3:["id", "name"]})',
    },
    {
      name: "read",
      signature: "read(model, ids, fields?, options?)",
      doc: "Read field values for given record IDs",
      snippet: 'read("${1:model}", ${2:[id]}, ${3:["id", "name"]})',
    },
    {
      name: "write",
      signature: "write(model, ids, values, options?)",
      doc: "Update records with given values",
      snippet: 'write("${1:model}", ${2:[id]}, { ${3:field}: ${4:value} })',
    },
    {
      name: "create",
      signature: "create(model, values, options?)",
      doc: "Create new records",
      snippet: 'create("${1:model}", { ${2:field}: ${3:value} })',
    },
    {
      name: "unlink",
      signature: "unlink(model, ids, options?)",
      doc: "Delete records by ID",
      snippet: 'unlink("${1:model}", ${2:[id]})',
    },
    {
      name: "readGroup",
      signature: "readGroup(model, domain, fields, groupby, options?)",
      doc: "Group records and aggregate fields",
      snippet:
        'readGroup("${1:model}", ${2:[]}, ${3:["count:count_distinct(id)"]}, ${4:["field"]})',
    },
    {
      name: "call",
      signature: "call(model, method, args?, kwargs?)",
      doc: "Call arbitrary model method",
      snippet: 'call("${1:model}", "${2:method}", ${3:[]}, { ${4} })',
    },
    {
      name: "webSearchRead",
      signature: "webSearchRead(model, domain?, fields?, options?)",
      doc: "Extended search_read for web client views",
      snippet:
        'webSearchRead("${1:model}", ${2:[]}, { fields: ${3:["id", "name"]} })',
    },
    {
      name: "nameSearch",
      signature: "nameSearch(model, name?, args?, operator?, limit?)",
      doc: "Search records by display name",
      snippet: 'nameSearch("${1:model}", "${2:query}")',
    },
    {
      name: "nameGet",
      signature: "nameGet(model, ids, options?)",
      doc: "Get display names for records",
      snippet: 'nameGet("${1:model}", ${2:[id]})',
    },
    {
      name: "fieldsGet",
      signature: "fieldsGet(model, allFields?, attributes?)",
      doc: "Get field definitions for a model",
      snippet: 'fieldsGet("${1:model}")',
    },
    {
      name: "onchange",
      signature: "onchange(model, ids, fieldNames, fieldOnchange, options?)",
      doc: "Compute onchange values",
      snippet: 'onchange("${1:model}", ${2:[]}, ${3:[]}, { ${4} })',
    },
  ],
  rpc: [
    {
      name: "call",
      signature: "call(route, params?)",
      doc: "Make a JSON-RPC call to the given route",
      snippet: 'call("${1:/web/dataset/call_kw}", { ${2} })',
    },
    {
      name: "query",
      signature: "query(params)",
      doc: "Execute a JSON-RPC query",
      snippet: "query({ ${1} })",
    },
  ],
  notification: [
    {
      name: "add",
      signature: "add(message, options?)",
      doc: "Display a notification to the user",
      snippet:
        'add("${1:message}", { type: "${2|info,warning,danger,success|}" })',
    },
  ],
  action: [
    {
      name: "doAction",
      signature: "doAction(action, options?)",
      doc: "Execute an action (id, xmlid, or descriptor)",
      snippet: "doAction(${1:actionId})",
    },
    {
      name: "switchView",
      signature: "switchView(viewType, props?)",
      doc: "Switch the current view type",
      snippet: 'switchView("${1|list,form,kanban,calendar|}")',
    },
    {
      name: "restore",
      signature: "restore()",
      doc: "Restore the last action state",
    },
    {
      name: "loadState",
      signature: "loadState(state, options?)",
      doc: "Restore action from URL state",
      snippet: "loadState(${1:state})",
    },
  ],
  router: [
    {
      name: "navigate",
      signature: "navigate(url, options?)",
      doc: "Navigate to a URL",
      snippet: 'navigate("${1:/odoo/}")',
    },
    {
      name: "pushState",
      signature: "pushState(state, options?)",
      doc: "Push a new URL state",
      snippet: "pushState({ ${1} })",
    },
    {
      name: "redirect",
      signature: "redirect(url, wait?)",
      doc: "Redirect the browser to a URL",
      snippet: 'redirect("${1:/odoo/}")',
    },
  ],
  hotkey: [
    {
      name: "add",
      signature: "add(hotkey, callback, options?)",
      doc: "Register a keyboard shortcut",
      snippet: 'add("${1:control+k}", () => {\n\t$0\n})',
    },
    {
      name: "remove",
      signature: "remove(hotkey, callback)",
      doc: "Unregister a keyboard shortcut",
      snippet: 'remove("${1:control+k}", ${2:callback})',
    },
  ],
  dialog: [
    {
      name: "add",
      signature: "add(Component, props?, options?)",
      doc: "Open a dialog component",
      snippet: "add(${1:Dialog}, { ${2} })",
    },
  ],
  overlay: [
    {
      name: "add",
      signature: "add(Component, props?, options?)",
      doc: "Add an overlay component",
      snippet: "add(${1:Component}, { ${2} })",
    },
    {
      name: "remove",
      signature: "remove(id)",
      doc: "Remove an overlay by ID",
      snippet: "remove(${1:id})",
    },
  ],
  title: [
    {
      name: "setParts",
      signature: "setParts(parts)",
      doc: "Set window title parts",
      snippet: 'setParts({ ${1:zopenerp}: "${2:Title}" })',
    },
    {
      name: "toString",
      signature: "toString()",
      doc: "Get the full window title string",
    },
  ],
};
