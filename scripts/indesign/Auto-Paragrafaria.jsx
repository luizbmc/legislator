#targetengine "session";
myDoc = app.activeDocument;
app.scriptPreferences.enableRedraw = false;
var cont = 0;
var sair = false;

var w = new Window('palette');
var currentDoc = w.add("statictext");
w.preferredSize.width = 225;

/*btn1.onClick = function() { 
	//alert(largo);
}*/
var story = app.selection[0].parentStory;
var paras = story.paragraphs.everyItem().getElements();
currentDoc.text = "Processando " + paras.length + " parágrafos...";
w.show();
//alert(paras.length);
Inicio();

function Inicio()
{
	for (var i=0; i<paras.length; i++)
	{
		if(paras[i].lines.length>1)
		{	
			if((paras[i].justification == Justification.LEFT_JUSTIFIED)||(paras[i].justification == Justification.RIGHT_JUSTIFIED))
			{
				if(paras[i].lines[paras[i].lines.length-1].characters.length < 13)
				{
					//progress.value += 1;
					mudaStatus(paras[i]);				
				}
			}
		}
	}
	w.close();
	alert(cont + " ocorrências corrigidas.");
}

function mudaStatus(para)
{
	
	w.update();
	//myWin.layout.layout(true);
	//mudaStatus();

	 var limite1 = 2;
	 var limite2 = 9;
	 var limite3 = 1;
	 
	 
  //DECLARA VARIÁVEIS
  var mudou = false;
  //var para = app.selection[0].paragraphs[0];
  //para.clearOverrides();
  var linhas = para.lines.length;
  var ultima = para.lines[para.lines.length-1].characters.length;
  
  var orig_letterD = para.desiredLetterSpacing;
  var orig_letterMin = para.minimumLetterSpacing;

  
  //CRIA ARRAY COM A QUANTIDADE DE CARACTERES EM CADA LINHA
  	  
  //para.hyphenWeight = 0;
  
  //********INICO DO CICLO DE AJUSTE DE ESPACAMENTO
  loop1:  
  for(var i = 0; i < limite1; i++)
  {
	  
	 // progress.value += 1;
	 ////alert(para.desiredLetterSpacing);
	//SE i FOR PAR, DIMINUI O DESIRED LETTER SPACING, SE IMPAR DIMINUI O MINIMUM LETTER SPACING
	if(i%2==0) 
	{
	 if(i==0)
	 para.minimumLetterSpacing = para.minimumLetterSpacing-limite3;
	 else 
	 para.minimumLetterSpacing = para.minimumLetterSpacing-limite3;	 
	}
	else
	 para.desiredLetterSpacing = para.desiredLetterSpacing-limite3;
	////alert(i + " - " + sair);
	
	//CHECA SE, APÓS O AJUSTE DO LETTER SPACING, HOUVE MUDANÇA NA QUANTIDADE DE CARACTERES EM CADA LINHA
	//SE SIM, RESETA O ARRAY "charLines" E ATUALIZA O MESMO
	if(para.lines.length!==linhas)
	{
		cont++;
		mudou = true;
		currentDoc.text = cont + " ocorrências corrigidas...";
		break;
	}
  }
  if(mudou==false)
  {
	para.desiredLetterSpacing = orig_letterD;
	para.minimumLetterSpacing = orig_letterMin;	
  }
}
