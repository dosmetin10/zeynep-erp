const modules = ['customersWindow','stockWindow','salesWindow','purchaseWindow','cashWindow','bankWindow','proposalWindow','invoiceWindow','reportsWindow','settingsWindow','usersWindow','backupWindow'];
const token = localStorage.getItem('mtn_token') || '';
if (token) document.getElementById('who').textContent = 'Oturum açık';

const btnWrap = document.getElementById('buttons');
modules.forEach((m)=>{
  const b=document.createElement('button');
  b.textContent=m;
  b.onclick=async()=>{
    try{await window.erpApi.openModuleWindow({token: localStorage.getItem('mtn_token')||'', windowName:m});}
    catch(e){document.getElementById('error').textContent=e.message;}
  };
  btnWrap.appendChild(b);
});

document.getElementById('setupBtn').onclick=async()=>{
  try{
    await window.erpApi.setupAdmin({username:username.value,password:password.value});
    alert('Admin oluşturuldu');
  }catch(e){document.getElementById('error').textContent=e.message;}
};

document.getElementById('loginBtn').onclick=async()=>{
  try{
    const res=await window.erpApi.login({username:username.value,password:password.value});
    localStorage.setItem('mtn_token',res.token);
    document.getElementById('who').textContent=res.user.username+' ('+res.user.roles.join(',')+')';
    const summary=await window.erpApi.reportSummary({token:res.token});
    document.getElementById('summary').textContent=JSON.stringify(summary,null,2);
  }catch(e){document.getElementById('error').textContent=e.message;}
};
