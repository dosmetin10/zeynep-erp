const token = localStorage.getItem('mtn_token') || '';

function errBox(e) {
  const t = typeof e === 'string' ? e : (e.message || 'Bilinmeyen hata');
  document.getElementById('error').textContent = `Ne oldu: İşlem başarısız\nNeden: ${t}\nNe yapmalısın: Alanları ve yetkini kontrol et\nReferans kod: UI-ERR`;
}

async function loadList(moduleName) {
  const search = document.getElementById('search')?.value || '';
  const rows = await window.erpApi.listData({ token, moduleName, search });
  const tbody = document.getElementById('rows');
  tbody.innerHTML = rows.map((r) => `<tr>${Object.values(r).slice(0,4).map((v)=>`<td>${v ?? ''}</td>`).join('')}</tr>`).join('') || '<tr><td class="muted">Kayıt yok</td></tr>';
}

window.moduleHelpers = { token, errBox, loadList };
