export function settlementLabel(status:string,provider:string){
 if(provider!=='manual')return status.replaceAll('_',' ');
 if(status==='PAID')return 'PAID EXTERNALLY';
 if(['DEBIT_SUCCEEDED','FUNDS_PENDING','FUNDS_AVAILABLE','PAYOUT_PENDING','PAYOUT_PROCESSING'].includes(status))return 'PAYMENT RECORDED — customer settlement pending';
 if(status==='REFUNDED')return 'EXTERNAL REFUND RECORDED';
 if(['CANCELLED','DISPUTED'].includes(status))return status;
 return 'AWAITING PAYMENT — manual settlement';
}
