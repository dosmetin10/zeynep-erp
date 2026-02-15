async function refresh(){
  try{
    const rows = await window.erpApi.listData({token:window.moduleHelpers.token,moduleName:'sales',search:''});
    document.getElementById('rows').innerHTML = rows.map(r=>`<tr><td>${r.invoice_no}</td><td>${r.net_total}</td><td>${r.status}</td></tr>`).join('') || '<tr><td>kayıt yok</td></tr>';
  }catch(e){window.moduleHelpers.errBox(e);}
}

document.getElementById('refresh').onclick=refresh;
document.getElementById('create').onclick=async()=>{
  try{
    await window.erpApi.createSales({token:window.moduleHelpers.token,data:{
      partyId:Number(partyId.value),
      collectionMethod:collectionMethod.value,
      lines:[{productId:Number(productId.value),quantity:Number(quantity.value),unitPrice:Number(unitPrice.value),discountRate:0}],
    }});
    refresh();
  }catch(e){window.moduleHelpers.errBox(e);}
};
refresh();
