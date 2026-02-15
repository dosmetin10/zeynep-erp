const token = localStorage.getItem('mtn_token') || '';
backup.onclick=async()=>{try{out.textContent=JSON.stringify(await window.erpApi.createBackup({token}),null,2);}catch(e){error.textContent=e.message;}};
restore.onclick=async()=>{try{out.textContent=JSON.stringify(await window.erpApi.restoreBackup({token}),null,2);}catch(e){error.textContent=e.message;}};
import.onclick=async()=>{try{out.textContent=JSON.stringify(await window.erpApi.importLegacyJson({token}),null,2);}catch(e){error.textContent=e.message;}};
