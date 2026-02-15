const moduleNameMap = { customers:'customers', stock:'stock', purchase:'suppliers', cash:'customers', bank:'customers', proposal:'customers', invoice:'sales', reports:'sales', settings:'sales', users:'customers', backup:'sales' };
const moduleName = moduleNameMap['invoice'];

const fields = {
  customers:[['name','Unvan'],['phone','Telefon'],['taxNo','VKN']],
  suppliers:[['name','Tedarikçi'],['phone','Telefon'],['taxNo','VKN']],
  stock:[['code','Kod'],['name','Ad'],['unit','Birim'],['vatRate','KDV'],['minLevel','Min'],['quantity','Açılış'],['unitCost','Maliyet']],
};

const row = document.getElementById('formRow');
(fields[moduleName]||[]).forEach(([k,p])=>{const i=document.createElement('input');i.id='f_'+k;i.placeholder=p;row.appendChild(i);});

async function refresh(){ try{ await window.moduleHelpers.loadList(moduleName);}catch(e){window.moduleHelpers.errBox(e);} }

document.getElementById('refresh').onclick=refresh;
document.getElementById('search').oninput=refresh;
document.getElementById('create').onclick=async()=>{
  try{
    if(!fields[moduleName]) return;
    const data={}; fields[moduleName].forEach(([k])=>data[k]=document.getElementById('f_'+k).value);
    await window.erpApi.createData({token:window.moduleHelpers.token,moduleName,data});
    refresh();
  }catch(e){window.moduleHelpers.errBox(e);} 
};
refresh();
